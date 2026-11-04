FROM node:22-bookworm-slim

WORKDIR /app

RUN corepack enable

COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

COPY . .

ENV BACKEND_HOST=0.0.0.0
ENV BACKEND_PORT=8787

EXPOSE 8787

CMD ["pnpm", "backend"]
