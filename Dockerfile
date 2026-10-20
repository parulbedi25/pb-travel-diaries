FROM node:22-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production PORT=4000
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund && npm cache clean --force
COPY app.cjs ./
COPY server ./server
COPY dist ./dist
COPY public ./public
RUN mkdir -p data media backup && chown -R node:node /app
USER node
EXPOSE 4000
CMD ["node", "app.cjs"]
