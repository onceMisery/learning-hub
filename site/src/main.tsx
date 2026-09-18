import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { App } from './App';
import { ErrorBoundary } from './components/ui/States';
import './styles/index.css';

const container = document.getElementById('root');
if (!container) {
  throw new Error('未找到 #root 挂载点，请检查 index.html');
}

createRoot(container).render(
  <StrictMode>
    <ErrorBoundary>
      {/* basename 跟随 vite 的 base 配置，部署到 GitHub Pages 子路径时无需改代码 */}
      <BrowserRouter basename={import.meta.env.BASE_URL}>
        <App />
      </BrowserRouter>
    </ErrorBoundary>
  </StrictMode>,
);
