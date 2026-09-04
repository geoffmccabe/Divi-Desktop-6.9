# NFD (Divi Collectibles) Arweave upload relay.
# The funded key is provided at runtime (env NFD_ARWEAVE_KEY -> a mounted file
# or secret), never baked into the image.
FROM node:20-slim
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev --ignore-scripts
COPY server.js ./
ENV PORT=8787
EXPOSE 8787
CMD ["node", "server.js"]
