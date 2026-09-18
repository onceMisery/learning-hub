import { Route, Routes } from 'react-router-dom';
import { MotionConfig } from 'motion/react';
import { Layout } from '@/components/Layout';
import { HomePage } from '@/pages/HomePage';
import { TrackPage } from '@/pages/TrackPage';
import { DocPage } from '@/pages/DocPage';
import { ComparePage } from '@/pages/ComparePage';
import { ProgressPage } from '@/pages/ProgressPage';
import { NotFoundPage } from '@/pages/NotFoundPage';

/**
 * 路由表。
 *
 * 静态路由放在前面，避免被 `/:trackId` 这类动态段提前吞掉。
 * 所有页面都挂在 Layout 下，以便共享顶栏、侧边栏与搜索面板。
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
          <Route path="/:trackId" element={<TrackPage />} />
          <Route path="/:trackId/:sectionId/:slug" element={<DocPage />} />
          <Route path="*" element={<NotFoundPage />} />
        </Route>
      </Routes>
    </MotionConfig>
  );
}
