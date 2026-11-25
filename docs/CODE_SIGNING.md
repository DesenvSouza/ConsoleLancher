# Code signing policy

**Status: the installers published so far are NOT code signed.** An application to the SignPath Foundation open source program is
being prepared. The statement below applies only after the project is accepted:

> Free code signing provided by [SignPath.io](https://about.signpath.io), certificate by [SignPath Foundation](https://signpath.org)

## License

[GNU General Public License, version 3](../LICENSE). The installer shows the privacy summary and the license before installing.

## Team roles

The project has a single maintainer, who holds every role.

| Role | Who |
|---|---|
| Authors and committers | [DesenvSouza](https://github.com/DesenvSouza) |
| Reviewers (changes from anyone else are reviewed before merging) | [DesenvSouza](https://github.com/DesenvSouza) |
| Approvers (each signing request is approved by hand) | [DesenvSouza](https://github.com/DesenvSouza) |

Multi-factor authentication is required for the repository and for the signing service.

## Builds

Release binaries are built only by GitHub Actions from the tagged source of this repository
([release.yml](../.github/workflows/release.yml)). Update packages are additionally signed with the project's update key, which the
launcher verifies before installing.

## What the program changes on your system

Every item is off until you choose it, except where noted, and is explained on screen.

| Change | Notes |
|---|---|
| Open at Windows sign-in | current user only |
| Console mode: the launcher replaces the Windows desktop shell | current user only; requires a restart; confirmation with the risks; undone on uninstall |
| FPS counter permission | adds your user to "Performance Log Users", after the Windows administrator prompt |
| While a game runs | the game is paused while the Guide menu or the launcher is in front of it |
| Steam windows (on by default in full screen) | Steam windows and notifications are kept out of the way, the Steam in-game overlay process is closed while notifications are hidden, and Big Picture mode is closed |
| Legendary (Epic installer, GPL-3.0) | downloaded from its official project only when you ask |

## Uninstall

Windows Settings › Apps › Console Launcher › Uninstall. The uninstaller restores the Windows desktop and removes the sign-in entry.

## Privacy

See [PRIVACY.md](PRIVACY.md).
