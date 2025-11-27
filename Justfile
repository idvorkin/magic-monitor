# Justfile

default:
    @just --list

# Run the development server
dev:
    npm run dev

# Build the project
build:
    npm run build

# Run unit tests
test:
    npm run test

# Run E2E tests (Playwright)
e2e:
    npx playwright test

# Deploy to Surge
deploy: test build
    npx surge dist magic-monitor.surge.sh
