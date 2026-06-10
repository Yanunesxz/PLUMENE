FROM node:22-alpine

RUN npm install -g pnpm@9

WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml* ./
COPY packages/ packages/
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json

RUN pnpm install --no-frozen-lockfile

COPY apps/api/ apps/api/
COPY packages/ packages/

RUN pnpm --filter @csb/api build

EXPOSE 3001

CMD ["node", "apps/api/dist/index.js"]
