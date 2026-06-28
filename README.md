# SPlayer ChatGPT Custom Build

This repository is a customized source publication copy of SPlayer for the user's self-hosted Web/Docker deployment and Android wrapper workflow.

## Upstream and License

- Upstream SPlayer: <https://github.com/SPlayer-Dev/SPlayer>
- Upstream author: imsyy / SPlayer-Dev
- License: AGPL-3.0, preserved in `LICENSE`

## Custom Work

The custom SPlayer changes in this repository were implemented by ChatGPT / Codex under user direction. They include Web/Docker deployment adaptation, self-hosted source integration, fallback source handling, and mobile APK compatibility work.

## Acknowledgements

Many thanks to the original SPlayer authors and contributors for releasing and maintaining the upstream project. This repository keeps the upstream license and attribution intact while publishing the user-directed custom modifications.

## Build

Install dependencies and build using the upstream package scripts:

```powershell
pnpm install
pnpm build
```

For Web/Docker deployment, review the included Docker and server configuration files and set runtime environment variables for your own deployment.
