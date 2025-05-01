import { useState, useEffect } from 'react';

// Countdown Timer Hook
export function useCountdown(targetTimestamp: bigint | null | undefined): string {
  const [timeLeft, setTimeLeft] = useState<string>("--:--:--");

  useEffect(() => {
    if (!targetTimestamp || targetTimestamp === 0n) {
      setTimeLeft("--:--:--");
      return;
    }

    const intervalId = setInterval(() => {
      const now = BigInt(Math.floor(Date.now() / 1000));
      const difference = targetTimestamp - now;

      if (difference <= 0) {
        setTimeLeft("Ready");
        clearInterval(intervalId);
      } else {
        const hours = String(Math.floor(Number(difference / 3600n))).padStart(2, '0');
        const minutes = String(Math.floor(Number((difference % 3600n) / 60n))).padStart(2, '0');
        const seconds = String(Number(difference % 60n)).padStart(2, '0');
        setTimeLeft(`${hours}:${minutes}:${seconds}`);
      }
    }, 1000);

    // Cleanup on component unmount or targetTimestamp change
    return () => clearInterval(intervalId);
  }, [targetTimestamp]);

  return timeLeft;
} 