# Building Vadana (Windows, macOS, Linux)

Vadana is a **Tauri 2** desktop app with a **Python WebSocket sidecar**. A release build packages the React UI, Rust shell, and a copy of `backend/` (source + `uv.lock`). End users still need **`uv` on PATH** and a one-time **`uv sync`** in the bundled backend folder unless you ship a pre-built `.venv` (not included by default).

Build on the **same OS** you are targeting. Cross-compiling desktop installers from one host to another is not supported out of the box.

---

## Prerequisites (all platforms)

| Tool | Purpose |
|------|---------|
| [Rust](https://www.rust-lang.org/tools/install) (stable) | Tauri / `cargo` |
| [Node.js](https://nodejs.org/) (LTS) | Frontend toolchain |
| [pnpm](https://pnpm.io/installation) | Package manager (`pnpm install`) |
| [uv](https://docs.astral.sh/uv/) | Python deps for the sidecar (`uv run`, `uv sync`) |

From the repo root:

```bash
pnpm install
```

### Platform-specific Tauri deps

**Windows**

- [Microsoft C++ Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/) (Desktop development with C++)
- [WebView2](https://developer.microsoft.com/microsoft-edge/webview2/) (usually already installed on Windows 10/11)

**macOS**

- Xcode Command Line Tools: `xcode-select --install`
- For distribution outside your Mac: Apple Developer account + code signing / notarization (optional but required for Gatekeeper-friendly releases)

**Linux** (Debian/Ubuntu example)

```bash
sudo apt update
sudo apt install -y \
  build-essential \
  curl wget file \
  libwebkit2gtk-4.1-dev \
  libayatana-appindicator3-dev \
  librsvg2-dev \
  patchelf
```

Other distros: see [Tauri — Linux prerequisites](https://v2.tauri.app/start/prerequisites/).

---

## Shared release steps

These steps are the same on every OS; only shell syntax for `sync-backend` differs (see below).

### 1. Lock Python dependencies

```bash
cd backend
uv lock
cd ..
```

### 2. Copy backend into Tauri resources

The installer bundles `src-tauri/resources/backend/` (see `tauri.conf.json` → `bundle.resources`).

**Windows (PowerShell):**

```powershell
pnpm run sync-backend
```

**macOS / Linux** — use PowerShell Core if installed:

```bash
pwsh -ExecutionPolicy Bypass -File scripts/sync-backend-resources.ps1
```

Or copy manually from the repo root:

```bash
mkdir -p src-tauri/resources/backend
cp backend/pyproject.toml backend/uv.lock backend/main.py backend/README.md src-tauri/resources/backend/
cp -R backend/live_voice src-tauri/resources/backend/
```

### 3. Build frontend + Tauri bundle

```bash
pnpm build
pnpm tauri build
```

`beforeBuildCommand` in `tauri.conf.json` runs `pnpm build` automatically when you only run `pnpm tauri build`; running both is fine and makes failures easier to read.

### 4. Find artifacts

Outputs are under `src-tauri/target/release/bundle/`:

| OS | Typical artifacts |
|----|-------------------|
| **Windows** | `nsis/Vadana_*_x64-setup.exe`, `msi/Vadana_*_x64_en-US.msi` |
| **macOS** | `macos/Vadana.app`, `dmg/Vadana_*_aarch64.dmg` or `*_x64.dmg` |
| **Linux** | `.deb`, `.AppImage`, or `.rpm` (depends on host and Tauri bundle targets) |

`bundle.targets` is set to `"all"` in `tauri.conf.json`, so Tauri emits every format it supports on that platform.

### 5. Optional: limit bundle formats

```bash
pnpm tauri build --bundles nsis                 # Windows (updater uses NSIS)
pnpm tauri build --bundles msi nsis             # Stable versions only — MSI rejects tags like `0.2.0-beta.1`
pnpm tauri build --bundles dmg                  # macOS example
pnpm tauri build --bundles deb appimage         # Linux example
```

---

## Windows

**Installer branding (NSIS):** `bundle.windows.nsis` in `src-tauri/tauri.conf.json` points at `icons/icon.ico` (setup/uninstall `.exe` icon) and `icons/nsis/*.bmp` (header + welcome sidebar). Regenerate those bitmaps after changing the logo:

```powershell
python scripts/generate-tauri-icons.py --input src-tauri/icons/icon.png
```

```powershell
cd backend
uv lock
cd ..
pnpm run sync-backend
pnpm install
pnpm tauri build
```

**Install / test on another PC**

1. Run the NSIS or MSI installer (or copy the built app from `bundle/`).
2. Install **uv** and ensure `uv --version` works in a terminal.
3. On first launch, open **Settings → General → Connect backend**. If connection fails, open the installed app’s backend folder (under the app install dir, `resources/backend`) and run:

   ```powershell
   cd "<path-to-installed-app>\resources\backend"
   uv sync
   ```

4. Install and start **LM Studio** (or another configured provider). Model weights (Whisper, Silero, Supertonic) download on first use.

**Logs:** `%LOCALAPPDATA%\vadana\logs\session.log` or set `LIVE_VOICE_LOG`.

---

## macOS

```bash
cd backend && uv lock && cd ..
pwsh -ExecutionPolicy Bypass -File scripts/sync-backend-resources.ps1
# or manual cp (see Shared release steps)
pnpm install
pnpm tauri build
```

**Notes**

- **Apple Silicon vs Intel:** build on the architecture you want to ship; use `pnpm tauri build -- --target aarch64-apple-darwin` or `x86_64-apple-darwin` only if you have the corresponding Rust targets installed.
- **Code signing / notarization:** not configured in this repo; unsigned builds may require right-click → Open the first time.
- **uv:** install via `curl -LsSf https://astral.sh/uv/install.sh | sh` and ensure `uv` is on `PATH` for GUI apps (e.g. login shell / `~/.local/bin`).

**Bundled backend path (release):** inside `Vadana.app` → `Contents/Resources/resources/backend/`. Run `uv sync` there if the app cannot start the sidecar.

---

## Linux

```bash
cd backend && uv lock && cd ..
pwsh -ExecutionPolicy Bypass -File scripts/sync-backend-resources.ps1
# or manual cp (see Shared release steps)
pnpm install
pnpm tauri build
```

**Notes**

- WebKitGTK and other dev packages must be installed before `cargo` can link (see prerequisites).
- For **AppImage**, you may need `libfuse2` on older distros to run the image.
- **uv:** `curl -LsSf https://astral.sh/uv/install.sh | sh` — ensure `~/.local/bin` is on `PATH`.

**After installing a `.deb` or running AppImage:** locate bundled `resources/backend` under the install prefix or mount, run `uv sync` once if backend connection fails.

---

## Development vs release backend path

| Mode | Backend directory |
|------|-------------------|
| `pnpm tauri dev` | `backend/` at repo root |
| `pnpm tauri build` (release) | `src-tauri/resources/backend/` → copied into the installer |

The app starts the sidecar with `uv run python main.py` in that directory.

---

## GPU builds (optional, build machine only)

Default `uv sync` is **CPU**. For NVIDIA CUDA (faster Whisper), on the machine where you build or where users will run `uv sync`:

```bash
cd backend
uv sync
uv pip uninstall torch torchaudio onnxruntime
uv pip install torch torchaudio --reinstall --index-url https://download.pytorch.org/whl/cu124
uv pip install onnxruntime-gpu --reinstall
```

See `backend/README.md` — **Runtime choice (CPU vs CUDA)**. Re-running `uv sync` may revert to CPU wheels; repeat CUDA steps if needed.

---

## Release + updater checklist

Vadana is in **public beta**. Use semver pre-release tags (for example `0.2.0-beta.1`). The GitHub Actions release workflow marks releases as **pre-release** when the version string contains `beta`, `alpha`, or `rc`.

Use this when shipping a new app version with auto-update.

### 1) Update version numbers

Update all three files to the same version (example `0.1.1`):

- `package.json` → `version`
- `src-tauri/Cargo.toml` → `[package].version`
- `src-tauri/tauri.conf.json` → `version`

### 2) Build release artifacts

`bundle.createUpdaterArtifacts` must be `true` in `src-tauri/tauri.conf.json` so `tauri build` writes `.sig` files for the updater.

From repo root:

```bash
pnpm run sync-backend
pnpm tauri build
```

Windows artifacts are generated under:

- `src-tauri/target/release/bundle/nsis/`
- `src-tauri/target/release/bundle/msi/`

### 3) Sign updater artifacts

This project uses Tauri updater signing keys:

- private key: `C:\Users\lohit\.tauri\vadana.key`
- public key: already set in `src-tauri/tauri.conf.json` under `plugins.updater.pubkey`

Set env vars before signing (GitHub secrets are **not** available in local shells):

```powershell
$env:TAURI_SIGNING_PRIVATE_KEY = Get-Content "$env:USERPROFILE\.tauri\vadana-2026p.key" -Raw
$env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = "<your key password>"
pnpm tauri build --bundles nsis
```

Or copy `.env.example` to `.env` (already in `.gitignore`), fill in your key + password, then:

```powershell
.\scripts\build-release.ps1
```

From **CMD**:

```cmd
scripts\build-release.cmd
```

Tauri does **not** read `.env` by itself; the script loads it and sets process env vars before `pnpm tauri build`.

Generate signatures for the artifact you reference in `latest.json` (for example NSIS `.exe`).

### 4) Update updater feed JSON

Update `app-showcase/public/latest.json`:

- `version`: new app version
- `notes`: release notes text
- `pub_date`: ISO UTC timestamp
- `platforms.windows-x86_64.url`: public download URL for installer (typically GitHub release asset)
- `platforms.windows-x86_64.signature`: signature from step 3

Current updater endpoint is configured to:

- `https://lohit-behera.github.io/vadana/latest.json`

### 5) Publish files

1. Upload installer asset(s) to GitHub Release (or another public host).
2. Commit/push updated `app-showcase/public/latest.json` so GitHub Pages serves the new metadata.
3. Existing app users can click **Settings → General → Check for updates**.

### 6) Files commonly changed per release

- `package.json`
- `src-tauri/Cargo.toml`
- `src-tauri/tauri.conf.json`
- `app-showcase/public/latest.json`
- optionally `.github/workflows/*` if changing release/deploy automation

### 7) GitHub Actions release workflow

Workflow file: `.github/workflows/release.yml`

**Use the existing signing key** (already generated for this project). Do **not** create a new key unless you also update `plugins.updater.pubkey` in `src-tauri/tauri.conf.json` to match the new `.pub` file.

| Local file | Purpose |
|------------|---------|
| `C:\Users\lohit\.tauri\vadana.key` | Private key — paste into GitHub secret (keep secret) |
| `C:\Users\lohit\.tauri\vadana.key.pub` | Public key — already in `tauri.conf.json` |
| Password | Optional. Set `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` only if your key was generated with a passphrase. |

#### Add repository secrets (GitHub UI)

Repo → **Settings** → **Secrets and variables** → **Actions** → **New repository secret**

| Name (exact) | Secret value |
|--------------|--------------|
| `TAURI_SIGNING_PRIVATE_KEY` | **Entire contents** of `vadana.key` (one multiline block). Copy in PowerShell: `Get-Content "$env:USERPROFILE\.tauri\vadana.key" -Raw` then paste into the **Secret** box. |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | Optional. Add only when your key was generated with a passphrase. |

Do not commit `vadana.key` to the repo.

#### Run a release

1. Bump version in `package.json`, `src-tauri/Cargo.toml`, and `src-tauri/tauri.conf.json` (must match).
2. Commit and push to `main`.
3. Repo → **Actions** → **Release Vadana** → **Run workflow**.
4. Enter **version** (e.g. `0.2.0-beta.2`) and optional **release notes** (mention beta expectations).
5. Workflow builds signed NSIS/MSI, updates `app-showcase/public/latest.json`, pushes it, and creates GitHub Release `v<version>` (pre-release when version contains `beta` / `alpha` / `rc`).
6. Ensure **Pages** deploy runs so `https://lohit-behera.github.io/vadana/latest.json` serves the new feed (push under `app-showcase/` triggers deploy).

---

## CI / clean build checklist

```bash
# Frontend + types
pnpm build

# Backend tests (optional)
cd backend && uv sync --all-groups && uv run pytest && cd ..

# Rust check
cd src-tauri && cargo check && cd ..

# Full installer
pnpm run sync-backend   # or pwsh / manual copy
pnpm tauri build
```

**Smoke test (dev, Windows):** `.\scripts\smoke.ps1 -SkipLm` from repo root.

---

## Troubleshooting builds

| Problem | What to try |
|---------|-------------|
| `uv` not found when running the installed app | Install uv; add to system/user `PATH`; restart Vadana |
| Flashing terminal / backend exits immediately | Run `uv sync` in bundled `resources/backend`; check logs |
| `pnpm tauri build` Rust errors on Linux | Install WebKitGTK / build-essential packages |
| macOS “app is damaged” | Sign/notarize, or allow via Security settings |
| Huge installer | Expected if you later bundle `.venv`; default bundle is source-only |
| Port `8765` in use | Stop other `uv run python main.py` or free the port |
| Knowledge **Rebuild index** fails (`No module named 'llama_index'`) | Close Vadana; run `uv sync` in `backend/` (dev) or bundled `resources/backend/` (release); first rebuild may download embedding models |

**Security:** the voice WebSocket binds to `127.0.0.1` only. Do not expose port `8765` to the network.

---

## Related docs

- [README.md](../README.md) — overview and quick start  
- [frontend.md](frontend.md) — UI dev and `pnpm tauri dev`  
- [backend/README.md](../backend/README.md) — sidecar, env vars, CUDA  
- [project-tree.md](project-tree.md) — repo layout  
