# Justfile

default:
    @just --list

# Run the development server
dev:
    npm run dev

# Build the project
build:
    npm run build

# Deploy to Surge
deploy: build
    npx surge dist magic-monitor.surge.sh
