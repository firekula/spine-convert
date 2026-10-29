/** 容器健康检查：探测 standalone 服务端口是否可正常响应。 */
const port = process.env.PORT ?? "3000";

try {
  const res = await fetch(`http://127.0.0.1:${port}/`);
  process.exit(res.ok ? 0 : 1);
} catch {
  process.exit(1);
}
