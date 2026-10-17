import hashlib
import importlib.util
import json
import tempfile
import unittest
from pathlib import Path
from zipfile import ZipFile

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location('release', ROOT / 'scripts' / 'release.py')
release = importlib.util.module_from_spec(spec)
spec.loader.exec_module(release)


class ReleaseTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.manifest = json.loads((ROOT / 'manifest.json').read_text())
        (self.root / 'manifest.json').write_text(json.dumps(self.manifest))
        (self.root / 'dist').mkdir()
        self.xpi = self.root / 'dist' / f"bookmark-toolbar-autoswitch-{self.manifest['version']}.xpi"
        # Minimal fixture, not a packaged extension or distribution build.
        with ZipFile(self.xpi, 'w') as archive:
            archive.writestr('manifest.json', json.dumps(self.manifest))
        self.calls = []
        self.releases = []
        self.refs = []
        self.commit = 'a' * 40

    def gh(self, *args):
        self.calls.append(args)
        if args[:3] == ('api', '--paginate', '--slurp'):
            return json.dumps([self.releases])
        if args[0] == 'api' and '/git/matching-refs/' in args[1]:
            return json.dumps(self.refs)
        if args[0] == 'api' and '/commits/' in args[1]:
            return json.dumps({'sha': getattr(self, 'tag_commit', self.commit)})
        return ''

    def publish(self):
        version, xpi, updates = release.prepare(self.root)
        release.publish(version, xpi, updates, self.commit, call=self.gh)

    def test_update_points_to_versioned_xpi_with_its_actual_hash_and_id(self):
        version, xpi, output = release.prepare(self.root)
        data = json.loads(output.read_text())
        addon_id = self.manifest['browser_specific_settings']['gecko']['id']
        update, = data['addons'][addon_id]['updates']
        self.assertEqual(update['version'], version)
        self.assertEqual(update['update_link'], f'{release.RELEASES_URL}/download/v{version}/{xpi.name}')
        self.assertEqual(update['update_hash'], 'sha256:' + hashlib.sha256(xpi.read_bytes()).hexdigest())

    def test_stale_package_is_rejected_before_generating_updates(self):
        self.manifest['version'] = '9.0.0'
        with ZipFile(self.xpi, 'w') as archive:
            archive.writestr('manifest.json', json.dumps(self.manifest))
        with self.assertRaisesRegex(ValueError, 'does not match'):
            release.prepare(self.root)
        self.assertFalse((self.root / 'dist' / 'updates.json').exists())

    def test_unexpected_update_url_is_rejected(self):
        self.manifest['browser_specific_settings']['gecko']['update_url'] = 'https://example.com/updates.json'
        (self.root / 'manifest.json').write_text(json.dumps(self.manifest))
        with self.assertRaisesRegex(ValueError, 'Unexpected update_url'):
            release.prepare(self.root)

    def test_versions_are_numeric_and_unambiguous(self):
        self.assertGreater(release.version_tuple('0.10.0'), release.version_tuple('0.9.0'))
        for value in ['v1.0.0', '01.0.0', '1.0', '1.0.0-beta', '1.0.0\n', '../1.0.0']:
            with self.subTest(value=value), self.assertRaises(ValueError):
                release.version_tuple(value)

    def test_publication_uploads_both_assets_to_a_draft_before_marking_latest(self):
        self.publish()
        mutations = [call for call in self.calls if call[0] == 'release']
        self.assertEqual([call[1] for call in mutations], ['create', 'upload', 'edit'])
        self.assertIn('--draft', mutations[0])
        self.assertIn(self.commit, mutations[0])
        self.assertIn(str(self.xpi), mutations[1])
        self.assertIn(str(self.root / 'dist' / 'updates.json'), mutations[1])
        self.assertIn('--draft=false', mutations[2])
        self.assertIn('--latest', mutations[2])

    def test_published_version_is_never_overwritten(self):
        self.releases = [{'tag_name': f"v{self.manifest['version']}", 'draft': False, 'prerelease': False}]
        self.publish()
        self.assertFalse(any(call[0] == 'release' for call in self.calls))

    def test_older_version_cannot_replace_latest(self):
        self.releases = [{'tag_name': 'v99.0.0', 'draft': False, 'prerelease': False}]
        with self.assertRaisesRegex(ValueError, 'newer stable release'):
            self.publish()
        self.assertFalse(any(call[0] == 'release' for call in self.calls))

    def test_existing_tag_must_point_to_the_tested_commit(self):
        self.refs = [{'ref': f"refs/tags/v{self.manifest['version']}"}]
        self.tag_commit = 'b' * 40
        with self.assertRaisesRegex(ValueError, 'different commit'):
            self.publish()
        self.assertFalse(any(call[0] == 'release' for call in self.calls))

    def test_matching_draft_can_be_resumed(self):
        self.releases = [{'tag_name': f"v{self.manifest['version']}", 'draft': True,
                          'prerelease': False, 'target_commitish': self.commit}]
        self.publish()
        self.assertEqual([call[1] for call in self.calls if call[0] == 'release'], ['upload', 'edit'])

    def test_failed_asset_upload_does_not_publish_release(self):
        def fail(*args):
            if args[:2] == ('release', 'upload'):
                raise RuntimeError('Upload failed')
            return self.gh(*args)
        version, xpi, updates = release.prepare(self.root)
        with self.assertRaisesRegex(RuntimeError, 'Upload failed'):
            release.publish(version, xpi, updates, self.commit, call=fail)
        self.assertFalse(any(call[:2] == ('release', 'edit') for call in self.calls))


if __name__ == '__main__':
    unittest.main()
