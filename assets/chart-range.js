/* Horizontal range selection for Chart.js; keeps ordinary touch scrolling intact. */
(() => {
  "use strict";
  const selections = new WeakMap();
  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
  window.ChartRangeSelection = {
    id: "rangeSelection",
    descriptors: { _scriptable: false, _indexable: false },
    afterInit(chart) {
      const canvas = chart.canvas;
      const options = chart.config.options.plugins.rangeSelection;
      let drag = null;
      const point = (event) => {
        const rect = canvas.getBoundingClientRect();
        return {
          x: ((event.clientX - rect.left) * chart.width) / rect.width,
          y: ((event.clientY - rect.top) * chart.height) / rect.height,
        };
      };
      const clear = () => {
        const previous = drag;
        drag = null;
        selections.delete(chart);
        canvas.classList.remove("is-selecting");
        if (previous && canvas.hasPointerCapture(previous.id))
          canvas.releasePointerCapture(previous.id);
        chart.draw();
      };
      const down = (event) => {
        if (event.button !== 0 || event.pointerType === "touch" || drag) return;
        const area = chart.chartArea;
        const p = point(event);
        if (
          !area ||
          p.x < area.left ||
          p.x > area.right ||
          p.y < area.top ||
          p.y > area.bottom
        )
          return;
        event.preventDefault();
        drag = { id: event.pointerId, start: p.x, end: p.x };
        selections.set(chart, drag);
        canvas.setPointerCapture(event.pointerId);
        canvas.classList.add("is-selecting");
        chart.draw();
      };
      const move = (event) => {
        if (!drag || drag.id !== event.pointerId) return;
        drag.end = clamp(
          point(event).x,
          chart.chartArea.left,
          chart.chartArea.right,
        );
        chart.draw();
      };
      const up = (event) => {
        if (!drag || drag.id !== event.pointerId) return;
        drag.end = clamp(
          point(event).x,
          chart.chartArea.left,
          chart.chartArea.right,
        );
        const selected = { ...drag };
        clear();
        if (Math.abs(selected.end - selected.start) < 8) return;
        const values = [selected.start, selected.end].map((x) =>
          chart.scales.x.getValueForPixel(x),
        );
        options.onSelect(Math.min(...values), Math.max(...values));
      };
      const cancel = (event) => {
        if (
          drag &&
          (event.type === "keydown"
            ? event.key === "Escape"
            : event.pointerId === drag.id)
        )
          clear();
      };
      const handlers = {
        pointerdown: down,
        pointermove: move,
        pointerup: up,
        pointercancel: cancel,
        lostpointercapture: cancel,
      };
      for (const [name, handler] of Object.entries(handlers))
        canvas.addEventListener(name, handler);
      document.addEventListener("keydown", cancel);
      chart.$rangeCleanup = () => {
        for (const [name, handler] of Object.entries(handlers))
          canvas.removeEventListener(name, handler);
        document.removeEventListener("keydown", cancel);
        clear();
      };
    },
    afterDraw(chart) {
      const selection = selections.get(chart);
      if (!selection) return;
      const { top, bottom } = chart.chartArea;
      const left = Math.min(selection.start, selection.end);
      const width = Math.abs(selection.end - selection.start);
      const ctx = chart.ctx;
      ctx.save();
      ctx.fillStyle = chart.config.options.plugins.rangeSelection.color + "26";
      ctx.strokeStyle = chart.config.options.plugins.rangeSelection.color;
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 3]);
      ctx.fillRect(left, top, width, bottom - top);
      ctx.strokeRect(left, top, width, bottom - top);
      ctx.restore();
    },
    beforeDestroy(chart) {
      chart.$rangeCleanup?.();
    },
  };
})();
