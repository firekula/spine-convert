/**
 * 容器首次启动建库脚本。
 *
 * 执行构建期由 `prisma migrate diff --from-empty --to-schema-datamodel` 生成的
 * docker/init.sql，直接使用 bun 内置 SQLite —— 镜像运行时无需携带 Prisma CLI
 * 与查询引擎。
 */
import { Database } from "bun:sqlite";

const url = process.env.DATABASE_URL ?? "file:/app/data/prod.db";
const dbPath = url.startsWith("file:") ? url.slice("file:".length) : url;

if (!dbPath.startsWith("/")) {
  console.error(`[init-db] 要求绝对路径的 DATABASE_URL，当前: ${url}`);
  process.exit(1);
}

const sql = await Bun.file(`${import.meta.dir}/init.sql`).text();

const db = new Database(dbPath);
try {
  db.exec("BEGIN");
  db.exec(sql);
  db.exec("COMMIT");
} catch (err) {
  db.exec("ROLLBACK");
  console.error(`[init-db] 建库失败: ${err}`);
  process.exit(1);
} finally {
  db.close();
}

console.log(`[init-db] 建库完成: ${dbPath}`);
