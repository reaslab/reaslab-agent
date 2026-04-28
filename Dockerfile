FROM oven/bun:1-alpine

RUN apk add --no-cache git ripgrep

WORKDIR /app

COPY package.json bun.lock tsconfig.json ./
RUN bun install --production --frozen-lockfile

COPY src/ ./src/
COPY skills/ ./skills/
COPY migration/ ./migration/
COPY drizzle.config.ts ./
COPY agent-schema.json /app/agent-schema.json

# Create data directory for SQLite
RUN mkdir -p /app/data

CMD ["bun", "run", "src/index.ts"]
