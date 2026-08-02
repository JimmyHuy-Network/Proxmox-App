# AGENTS.md

## Cursor Cloud specific instructions

Standard commands (lint/test/typecheck/build/run) are documented in `README.md` and the
root `package.json` scripts; don't duplicate them here. Notes below are the non-obvious,
durable caveats for this cloud VM.

### Node version (important)

This repo needs **Node ≥ 22.18** at runtime: the mock server is run as `node src/index.ts`
and relies on Node's native TypeScript type-stripping (only on by default in 22.18+), and
`undici` wants ≥ 22.19. The VM's injected `/exec-daemon/node` is **22.14** and is too old —
using it makes `npm run dev:mock` fail with `ERR_UNKNOWN_FILE_EXTENSION`.

An nvm-managed **Node v22.22.2** is installed and set as the nvm default. `~/.bashrc` has
been configured to put the nvm default Node ahead of `/exec-daemon` on `PATH`, so any fresh
login shell already resolves `node` to 22.22.2 (verify with `node --version`). If you ever
spawn a shell that still shows 22.14, run `nvm use default` or prepend
`"$(dirname "$(nvm which default)")"` to `PATH`.

### Services

- **Mock Proxmox VE server** (`@pve/mock-server`): `npm run dev:mock` → `https://127.0.0.1:8006`
  (self-signed TLS, in-memory `cluster-3node` fixture: nodes pve1/pve2/pve3 + VMs/CTs). Login
  is any username + any password **except** the literal `sai`; `tfa@pve` requires OTP `123456`;
  API token `root@pam!automation=00000000-1111-2222-3333-444444444444`. Dev-only control API
  under `/__mock/*` (see `README.md`).
- **Desktop app** (`@pve/desktop`, Electron): `npm run dev` (renderer via Vite on `:5173`).
  Needs a display — use `DISPLAY=:1` (the VM's X server). The `dbus` and `WebGL1 blocklisted`
  errors in the Electron log are benign in this container.

### Headless credential storage caveat (non-obvious)

Electron `safeStorage` (OS keyring / libsecret) is **not available** on this headless VM, so
the normal "Thêm kết nối" (add connection) UI flow fails to persist credentials with an error
like *"Không mã hoá được credential"*. This is an environment limitation, not a bug.

To get a working connection for manual/GUI testing, use the built-in E2E hook (documented in
`docs/handoff.md` §6) which seeds the vault with a plain-text encryptor and auto-connects to
the mock server:

```bash
DISPLAY=:1 PVE_E2E_MOCK_URL=https://127.0.0.1:8006 npm run dev
```

Optional: `PVE_E2E_USER` (default `root@pam`), `PVE_E2E_PASSWORD` (default `x`). After launch
the resource tree (Datacenter → nodes → guests) appears and guest power actions / snapshots
work end to end against the mock.
