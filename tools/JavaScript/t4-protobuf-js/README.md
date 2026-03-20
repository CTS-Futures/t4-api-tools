# t4-protobuf-js

Simple build instructions for generating protobuf artifacts and package outputs.

## Prerequisites

- Node.js 18+ (or current LTS)
- npm

## Install dependencies

### Windows (PowerShell)
```powershell
npm install
```

### Linux (bash)
```bash
npm install
```

## Build artifacts

This runs proto copy/generation, webpack bundling, and TypeScript declaration output.

### Windows (PowerShell)
```powershell
npm run build
```

### Linux (bash)
```bash
npm run build
```

## Output folders

- `dist/` -> JavaScript bundles (`main`, `module`, `browser`)
- `types/` -> Type declarations

## Optional: clean generated outputs

### Windows (PowerShell)
```powershell
npm run clean
```

### Linux (bash)
```bash
npm run clean
```

## Optional: run steps manually

### Windows (PowerShell)
```powershell
npm run copy-proto
npm run build:proto
npx webpack
npx tsc --declaration --emitDeclarationOnly --outDir types --declarationDir types
```

### Linux (bash)
```bash
npm run copy-proto
npm run build:proto
npx webpack
npx tsc --declaration --emitDeclarationOnly --outDir types --declarationDir types
```
