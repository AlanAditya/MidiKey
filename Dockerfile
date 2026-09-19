# --- build the web app ---
FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
COPY scripts ./scripts
RUN npm ci
COPY . .
RUN npm run build

# --- runtime: blind relay + static app on one origin ---
FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production PORT=8787 DATA_DIR=/app/data
COPY package*.json ./
RUN npm ci --omit=dev --ignore-scripts
COPY server ./server
COPY --from=build /app/dist ./dist
VOLUME /app/data
EXPOSE 8787
USER node
CMD ["node", "server/index.mjs"]
