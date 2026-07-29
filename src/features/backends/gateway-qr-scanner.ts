import QrScanner from "qr-scanner";

export async function startGatewayQrScanner(
  video: HTMLVideoElement,
  onResult: (value: string) => void,
) {
  const scanner = new QrScanner(
    video,
    (result) => onResult(result.data),
    {
      preferredCamera: "environment",
      highlightScanRegion: true,
      highlightCodeOutline: true,
      returnDetailedScanResult: true,
    },
  );
  try {
    await scanner.start();
  } catch (error) {
    scanner.destroy();
    throw error;
  }
  return () => scanner.destroy();
}

export async function scanGatewayQrImage(file: File) {
  const result = await QrScanner.scanImage(file, {
    returnDetailedScanResult: true,
    alsoTryWithoutScanRegion: true,
  });
  return result.data;
}
