# Container for the GEO/SEO optimizer. Includes headless Chromium (needed to
# render JS-heavy Wix posts) via `playwright install --with-deps`.
FROM node:20-bookworm-slim

WORKDIR /app

# Install deps first (better layer caching).
COPY package*.json ./
RUN npm install

# Install Chromium + the OS libraries Playwright needs (root in build stage).
RUN npx playwright install --with-deps chromium

COPY . .

ENV NODE_ENV=production
# Render (and most hosts) inject PORT; the server reads process.env.PORT.
ENV PORT=5173
EXPOSE 5173

CMD ["npm", "run", "ui"]
