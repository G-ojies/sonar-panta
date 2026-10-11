# The Sonar web app as a container: the package stage pushes it to the GitLab registry.
# Render builds from source (render.yaml); this image is the same app, for anyone who wants to run it elsewhere.
FROM node:20-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY scripts/fix-types.js scripts/fix-types.js
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build

FROM node:20-bookworm-slim
WORKDIR /app
ARG COMMIT
ENV NODE_ENV=production RENDER_GIT_COMMIT=$COMMIT PORT=3000
COPY --from=build /app ./
EXPOSE 3000
CMD ["npm", "run", "start"]
