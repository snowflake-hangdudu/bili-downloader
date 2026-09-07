/*
 * DASH 合成专用 Worker。
 *
 * 页面线程只负责下载 UI 与交互；重排 MP4 box、聚合输出 Blob 等 CPU 密集型工作在此执行。
 * 所有代码均随扩展打包，未加载远程代码。
 */
importScripts('mp4-remux.iife.js', 'm4s-mux.js');

(function () {
  'use strict';

  const PROGRESS_INTERVAL_BYTES = 16 * 1024 * 1024;
  const cancelledJobs = new Set();

  function errorMessage(error) {
    return error?.message || String(error || '合并失败');
  }

  function isCancelled(jobId) {
    return cancelledJobs.has(jobId);
  }

  self.postMessage({ type: 'READY' });

  self.addEventListener('message', async (event) => {
    const data = event.data || {};
    if (data.type === 'CANCEL') {
      cancelledJobs.add(data.jobId);
      return;
    }
    if (data.type !== 'MERGE' || !data.jobId) return;

    const { jobId, videoBlob, audioBlob } = data;
    const total = Number(videoBlob?.size || 0) + Number(audioBlob?.size || 0);
    const startedAt = Date.now();
    let processed = 0;
    let lastReported = 0;

    try {
      const blob = await self.BiliM4sMux.mergeM4s(videoBlob, audioBlob, self.mp4Remux, {
        shouldCancel: () => isCancelled(jobId),
        onChunk: (bytes) => {
          processed = Math.min(total, processed + Number(bytes || 0));
          if (processed - lastReported < PROGRESS_INTERVAL_BYTES && processed < total) return;
          lastReported = processed;
          const elapsedMs = Math.max(1, Date.now() - startedAt);
          const bytesPerSecond = processed * 1000 / elapsedMs;
          const etaMs = bytesPerSecond > 0 && total > processed
            ? Math.round((total - processed) / bytesPerSecond * 1000)
            : 0;
          self.postMessage({
            type: 'PROGRESS',
            jobId,
            received: processed,
            total,
            elapsedMs,
            etaMs
          });
        }
      });
      if (isCancelled(jobId)) throw new Error('下载已取消');
      self.postMessage({ type: 'DONE', jobId, blob, total, elapsedMs: Date.now() - startedAt });
    } catch (error) {
      self.postMessage({ type: 'ERROR', jobId, error: errorMessage(error) });
    } finally {
      cancelledJobs.delete(jobId);
    }
  });
})();
