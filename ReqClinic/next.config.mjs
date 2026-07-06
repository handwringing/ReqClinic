/** @type {import('next').NextConfig} */
const nextConfig = {
  devIndicators: false,
  // dev 与 build 物理隔离：build 产物写入 .next-build，永不污染 dev 的 .next 缓存，
  // 根治 build 后启动 dev 报 ENOENT (_document.js / vendor-chunks/*.js) 的问题。
  // `next start` 也指向 .next-build，与 build 配对使用。
  distDir: process.env.NEXT_BUILD_OUTPUT || '.next',
};

export default nextConfig;
