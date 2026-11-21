FROM node:24-bookworm-slim
WORKDIR /workspace
RUN corepack enable
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml tsconfig.base.json ./
COPY packages/core/package.json packages/core/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN pnpm install --frozen-lockfile --prod --filter @veil/api...
COPY packages/core packages/core
COPY apps/api apps/api
ENV HOST=0.0.0.0
USER node
WORKDIR /workspace/apps/api
CMD ["node", "--import", "tsx", "server.ts"]
