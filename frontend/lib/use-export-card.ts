"use client";

import { useCallback, useState } from "react";
import { domToPng } from "modern-screenshot";

export function useExportCard() {
  const [exporting, setExporting] = useState(false);

  const exportAsPng = useCallback(async (element: HTMLElement, filename: string) => {
    setExporting(true);
    try {
      const dataUrl = await domToPng(element, {
        scale: 3,
      });
      const link = document.createElement("a");
      link.download = `${filename}.png`;
      link.href = dataUrl;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } finally {
      setExporting(false);
    }
  }, []);

  return { exporting, exportAsPng };
}
