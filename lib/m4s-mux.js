/**
 * 纯 JS 合并 B 站 DASH m4s（无 FFmpeg / 无 SharedArrayBuffer）
 * 基于 mp4-remux: https://github.com/mscststs/mp4-remux
 */
(function (global) {
  'use strict';

  function bufferToStream(buffer) {
    const data = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
    return new ReadableStream({
      start(controller) {
        controller.enqueue(data);
        controller.close();
      }
    });
  }

  async function streamToBlob(stream, type) {
    const reader = stream.getReader();
    const chunks = [];
    let total = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      total += value.length;
    }
    return { blob: new Blob(chunks, { type: type || 'video/mp4' }), size: total };
  }

  async function mergeM4s(videoBuffer, audioBuffer, remuxFn) {
    if (!videoBuffer?.byteLength) throw new Error('视频数据为空');
    if (!audioBuffer?.byteLength) throw new Error('音频数据为空');
    if (typeof remuxFn !== 'function') throw new Error('mp4-remux 未加载');

    const out = remuxFn(
      bufferToStream(videoBuffer),
      bufferToStream(audioBuffer)
    );
    const { blob, size } = await streamToBlob(out, 'video/mp4');
    if (size < 1024) throw new Error('合并结果为空');
    return blob;
  }

  global.BiliM4sMux = { mergeM4s, bufferToStream, streamToBlob };
})(typeof window !== 'undefined' ? window : globalThis);
