"""Generate Gecko update metadata; publish only with explicit --publish."""

import argparse
import hashlib
import json
import os
import re
import subprocess
from pathlib import Path
from zipfile import ZipFile

ROOT = Path(__file__).resolve().parent.parent
REPOSITORY = 'just-better-code/floorp-workspace-bookmark-switcher'
RELEASES_URL = f'https://github.com/{REPOSITORY}/releases'
UPDATE_URL = f'{RELEASES_URL}/latest/download/updates.json'


def version_tuple(version):
    if not re.fullmatch(r'(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)', version):
        raise ValueError('Release version must have the form X.Y.Z without leading zeros')
    return tuple(int(part) for part in version.split('.'))


def prepare(root=ROOT):
    manifest = json.loads((root / 'manifest.json').read_text())
    version = manifest['version']
    version_tuple(version)
    gecko = manifest['browser_specific_settings']['gecko']
    if gecko['update_url'] != UPDATE_URL:
        raise ValueError('Unexpected update_url; existing installations need a stable URL')
    filename = f'bookmark-toolbar-autoswitch-{version}.xpi'
    xpi = root / 'dist' / filename
    with ZipFile(xpi) as archive:
        packaged = json.loads(archive.read('manifest.json'))
    if packaged != manifest:
        raise ValueError('Packaged manifest does not match the source manifest')
    update = {
        'version': version,
        'update_link': f'{RELEASES_URL}/download/v{version}/{filename}',
        'update_hash': f'sha256:{hashlib.sha256(xpi.read_bytes()).hexdigest()}',
        'update_info_url': f'{RELEASES_URL}/tag/v{version}',
    }
    compatibility = {key: gecko[key] for key in ('strict_min_version', 'strict_max_version') if key in gecko}
    if compatibility:
        update['applications'] = {'gecko': compatibility}
    output = root / 'dist' / 'updates.json'
    output.write_text(json.dumps({'addons': {gecko['id']: {'updates': [update]}}}, indent=2) + '\n')
    return version, xpi, output


def gh(*args):
    return subprocess.check_output(['gh', *args], text=True)


def publish(version, xpi, updates, commit, call=gh):
    if not re.fullmatch(r'[0-9a-f]{40}', commit):
        raise ValueError('Expected the full tested commit SHA')
    tag = f'v{version}'
    pages = json.loads(call('api', '--paginate', '--slurp', f'repos/{REPOSITORY}/releases?per_page=100'))
    releases = [release for page in pages for release in page]
    existing = next((release for release in releases if release['tag_name'] == tag), None)
    if existing and not existing['draft']:
        print(f'{tag} is already published; leaving its tag and assets unchanged')
        return
    for release in releases:
        if release['draft'] or release['prerelease']:
            continue
        try:
            newer = version_tuple(release['tag_name'].removeprefix('v')) > version_tuple(version)
        except ValueError:
            continue
        if newer:
            raise ValueError('Refusing to replace a newer stable release with an older version')
    refs = json.loads(call('api', f'repos/{REPOSITORY}/git/matching-refs/tags/{tag}'))
    if any(ref['ref'] == f'refs/tags/{tag}' for ref in refs):
        tagged = json.loads(call('api', f'repos/{REPOSITORY}/commits/{tag}'))
        if tagged['sha'] != commit:
            raise ValueError('The release tag already points to a different commit')
    elif existing and existing['target_commitish'] != commit:
        raise ValueError('The draft release targets a different commit')
    if existing and existing['prerelease']:
        raise ValueError('Refusing to reuse a prerelease as a stable release')
    if not existing:
        call('release', 'create', tag, '--repo', REPOSITORY, '--target', commit,
             '--title', tag, '--draft', '--generate-notes', '--notes',
             'Floorp only. Uses privileged experimental APIs; this XPI is not signed by AMO.')
    # Upload both assets before publication so update checks never see a partial release.
    call('release', 'upload', tag, str(xpi), str(updates), '--repo', REPOSITORY, '--clobber')
    call('release', 'edit', tag, '--repo', REPOSITORY, '--draft=false', '--latest')
    print(f'Published {tag}')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--publish', action='store_true')
    args = parser.parse_args()
    if args.publish and (os.environ.get('GITHUB_REPOSITORY') != REPOSITORY
                         or os.environ.get('GITHUB_REF') != 'refs/heads/main'):
        raise ValueError('Publishing is restricted to the canonical main branch')
    version, xpi, updates = prepare()
    print(updates)
    if args.publish:
        publish(version, xpi, updates, os.environ['GITHUB_SHA'])


if __name__ == '__main__':
    main()
