# Justfile

default:
    @just --list

# Run the development server
dev:
    npm run dev

# Build the project (generates version info first)
build:
    bash scripts/generate-version.sh && npm run build

# Run unit tests
test:
    npm run test

# Run E2E tests (Playwright) - all projects
e2e:
    npx playwright test

# Run E2E tests - desktop only
e2e-desktop:
    npx playwright test --project=chromium

# Run E2E tests - mobile only
e2e-mobile:
    npx playwright test --project=mobile

# View E2E test report (Tailscale accessible)
e2e-report:
    npx playwright show-report --host 0.0.0.0

# Run E2E tests with interactive UI
e2e-ui:
    npx playwright test --ui

# Deploy to Surge
deploy: test build
    npx surge dist magic-monitor.surge.sh
