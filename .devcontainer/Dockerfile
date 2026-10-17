FROM node:24.21.0-bookworm-slim

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates curl git \
    && rm -rf /var/lib/apt/lists/*

RUN groupmod --new-name columbo node \
    && usermod --login columbo --home /home/columbo --move-home node

ENV HOME=/home/columbo
USER columbo
WORKDIR /home/columbo/Projects/floorp-workspace-bookmark-switcher
CMD ["sleep", "infinity"]
