/**
 * 纯 JS 合并 B 站 DASH m4s（无 FFmpeg / 无 SharedArrayBuffer）
 * 基于 mp4-remux: https://github.com/mscststs/mp4-remux
 */
(function (global) {
  'use strict';

  // 将大文件拆为小段传给 remux。原先一次性 arrayBuffer() 会让 1GB+ 文件在页面主线程
  // 长时间同步解析，连关闭/取消按钮都无法响应。
  const MERGE_CHUNK_BYTES = 4 * 1024 * 1024;

  function cancelledError() {
    return new Error('下载已取消');
  }

  function isCancelled(check) {
    try { return typeof check === 'function' && check(); } catch { return false; }
  }

  function yieldToBrowser() {
    return new Promise((resolve) => setTimeout(resolve, 0));
  }

  function bufferToStream(buffer) {
    const data = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
    return new ReadableStream({
      start(controller) {
        controller.enqueue(data);
        controller.close();
      }
    });
  }

  /**
   * 从 Blob 流中聚合固定大小的片段。每次 pull 之前切回浏览器事件循环，
   * 让浮窗关闭、取消与页面交互在大文件合成期间仍可响应。
   */
  function blobToPacedStream(blob, options = {}) {
    const chunkBytes = Math.max(256 * 1024, Number(options.chunkBytes) || MERGE_CHUNK_BYTES);
    const shouldCancel = options.shouldCancel;
    const onChunk = options.onChunk;
    let reader;
    let pending = null;
    let pendingOffset = 0;
    let ended = false;

    return new ReadableStream({
      async start() {
        if (!blob?.stream) throw new Error('浏览器不支持流式合成');
        reader = blob.stream().getReader();
      },
      async pull(controller) {
        // 必须在下一段开始前让出一次主线程；否则 await 链会持续占住页面。
        await yieldToBrowser();
        if (isCancelled(shouldCancel)) {
          try { await reader.cancel(); } catch { /* ignore */ }
          controller.error(cancelledError());
          return;
        }
        if (ended) {
          controller.close();
          return;
        }

        const output = new Uint8Array(chunkBytes);
        let offset = 0;
        while (offset < output.length) {
          if (isCancelled(shouldCancel)) {
            try { await reader.cancel(); } catch { /* ignore */ }
            controller.error(cancelledError());
            return;
          }
          if (!pending || pendingOffset >= pending.length) {
            const next = await reader.read();
            if (next.done) {
              ended = true;
              break;
            }
            pending = next.value instanceof Uint8Array ? next.value : new Uint8Array(next.value);
            pendingOffset = 0;
          }
          const count = Math.min(output.length - offset, pending.length - pendingOffset);
          output.set(pending.subarray(pendingOffset, pendingOffset + count), offset);
          offset += count;
          pendingOffset += count;
        }

        if (!offset) {
          controller.close();
          return;
        }
        const value = offset === output.length ? output : output.slice(0, offset);
        controller.enqueue(value);
        try { onChunk?.(value.length); } catch { /* progress must never break merging */ }
      },
      async cancel(reason) {
        try { await reader?.cancel(reason); } catch { /* ignore */ }
      }
    });
  }

  async function streamToBlob(stream, type, shouldCancel) {
    const reader = stream.getReader();
    const chunks = [];
    let total = 0;
    while (true) {
      if (isCancelled(shouldCancel)) {
        try { await reader.cancel(); } catch { /* ignore */ }
        throw cancelledError();
      }
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      total += value.length;
    }
    return { blob: new Blob(chunks, { type: type || 'video/mp4' }), size: total };
  }

  async function validateFragmentedInput(blob, shouldCancel) {
    let offset = 0, fragments = 0, media = 0, references = 0;
    const kinds = new Set();
    while (offset < blob.size) {
      if (isCancelled(shouldCancel)) throw cancelledError();
      const bytes = new Uint8Array(await blob.slice(offset, offset + 40).arrayBuffer());
      if (bytes.length < 8) throw new Error('媒体文件尾部不完整');
      const view = new DataView(bytes.buffer);
      const size = view.getUint32(0);
      const type = String.fromCharCode(...bytes.subarray(4, 8));
      // The bundled remuxer only handles ordinary 32-bit boxes and indexed fragments.
      if (size < 8 || offset + size > blob.size) throw new Error('媒体封装不完整或当前合成器不支持该封装');
      kinds.add(type);
      if (type === 'moof') {
        fragments++;
        if (bytes.length < 24 || String.fromCharCode(...bytes.subarray(12, 16)) !== 'mfhd' || view.getUint32(20) !== fragments) {
          throw new Error('媒体片段序号不连续，请切换清晰度后重试');
        }
      }
      if (type === 'mdat') media++;
      if (type === 'sidx') {
        const countOffset = bytes[8] === 0 ? 30 : 38;
        if (bytes.length < countOffset + 2 || size < countOffset + 2) throw new Error('媒体索引不完整');
        references += view.getUint16(countOffset);
      }
      offset += size;
    }
    if (!kinds.has('moov') || !fragments || references !== fragments || media !== fragments) {
      throw new Error('媒体片段与索引不匹配，请切换清晰度后重试');
    }
  }

  async function mergeM4s(videoBlob, audioBlob, remuxFn, options = {}) {
    if (!videoBlob?.size) throw new Error('视频数据为空');
    if (!audioBlob?.size) throw new Error('音频数据为空');
    if (typeof remuxFn !== 'function') throw new Error('mp4-remux 未加载');

    const shouldCancel = options.shouldCancel;
    await validateFragmentedInput(videoBlob, shouldCancel);
    await validateFragmentedInput(audioBlob, shouldCancel);
    const out = remuxFn(
      blobToPacedStream(videoBlob, { shouldCancel, onChunk: options.onChunk }),
      blobToPacedStream(audioBlob, { shouldCancel, onChunk: options.onChunk })
    );
    const { blob, size } = await streamToBlob(out, 'video/mp4', shouldCancel);
    if (size < 1024) throw new Error('合并结果为空');
    return blob;
  }

  global.BiliM4sMux = { mergeM4s, bufferToStream, blobToPacedStream, streamToBlob, validateFragmentedInput };
})(typeof window !== 'undefined' ? window : globalThis);
