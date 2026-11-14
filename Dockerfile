# Build with the full toolchain, ship only Next's standalone server on distroless Node:
# no shell, no npm, no package manager, runs as a non-root user.

FROM node:24-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
# The model runs on the CPU: skip onnxruntime's ~270 MB CUDA download.
RUN ONNXRUNTIME_NODE_INSTALL=skip npm ci --no-audit --no-fund
COPY . .
RUN NEXT_OUTPUT=standalone npx next build \
 && mkdir -p /data

FROM gcr.io/distroless/nodejs24-debian13:nonroot
WORKDIR /app
ENV NODE_ENV=production \
    HOSTNAME=0.0.0.0 \
    PORT=3000 \
    NOTES_PATH=/data
COPY --from=build --chown=nonroot:nonroot /data /data
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/public ./public
VOLUME /data
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD ["/nodejs/bin/node", "-e", "fetch('http://127.0.0.1:3000/login').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"]
CMD ["server.js"]
