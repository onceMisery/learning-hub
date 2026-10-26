import { Route, Routes } from 'react-router-dom';
import { MotionConfig } from 'motion/react';
import { Layout } from '@/components/Layout';
import { HomePage } from '@/pages/HomePage';
import { TrackPage } from '@/pages/TrackPage';
import { DocPage } from '@/pages/DocPage';
import { ComparePage } from '@/pages/ComparePage';
import { ProgressPage } from '@/pages/ProgressPage';
import { AgentLabPage } from '@/pages/AgentLabPage';
import { CassandraLabPage } from '@/pages/CassandraLabPage';
import { ClickHouseLabPage } from '@/pages/ClickHouseLabPage';
import { MiddlewareLabPage } from '@/pages/MiddlewareLabPage';
import { ParquetLabPage } from '@/pages/ParquetLabPage';
import { RocksdbLabPage } from '@/pages/RocksdbLabPage';
import { SeataLabPage } from '@/pages/SeataLabPage';
import { NotFoundPage } from '@/pages/NotFoundPage';

/**
 * 路由表。
 *
 * 静态路由放在前面，避免被 `/:trackId` 这类动态段提前吞掉。
 * 所有页面都挂在 Layout 下，以便共享顶栏、侧边栏与搜索面板。
 *
 * `/agent/lab/:chapterId?`、`/cassandra/lab/:chapterId?`、`/clickhouse/lab/:chapterId?`、`/middleware/lab/:chapterId?` 与 `/seata/lab/:chapterId?`
 * 是互动原理实验室：iframe 承载 public/*-lab/ 下的自包含图解页。它们有两段也有三段，
 * 必须写在 `/:trackId/:sectionId/:slug` 之前，否则 `/middleware/lab/01-xxx`
 * 会被误抢成文档页。
 */
export function App() {
  return (
    // reducedMotion="user" 让全局动画自动尊重系统的「减少动态效果」偏好，
    // 默认是 "never"，必须显式开启。
    <MotionConfig reducedMotion="user">
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<HomePage />} />
          <Route path="/compare" element={<ComparePage />} />
          <Route path="/progress" element={<ProgressPage />} />
          <Route path="/agent/lab/:chapterId?" element={<AgentLabPage />} />
          <Route path="/cassandra/lab/:chapterId?" element={<CassandraLabPage />} />
          <Route path="/clickhouse/lab/:chapterId?" element={<ClickHouseLabPage />} />
          <Route path="/middleware/lab/:chapterId?" element={<MiddlewareLabPage />} />
          <Route path="/parquet/lab/:chapterId?" element={<ParquetLabPage />} />
          <Route path="/rocksdb/lab/:chapterId?" element={<RocksdbLabPage />} />
          <Route path="/seata/lab/:chapterId?" element={<SeataLabPage />} />
          <Route path="/:trackId" element={<TrackPage />} />
          <Route path="/:trackId/:sectionId/:slug" element={<DocPage />} />
          <Route path="*" element={<NotFoundPage />} />
        </Route>
      </Routes>
    </MotionConfig>
  );
}
