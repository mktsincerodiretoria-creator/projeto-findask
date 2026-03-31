"use client";

interface ProgressBarProps {
  progress: number; // 0 to 100
  label?: string;
  show: boolean;
}

export default function ProgressBar({ progress, label, show }: ProgressBarProps) {
  if (!show) return null;

  return (
    <div className="w-full bg-gray-200 rounded-full h-4 overflow-hidden relative">
      <div
        className="h-full bg-gradient-to-r from-blue-500 to-blue-600 rounded-full transition-all duration-300 ease-out"
        style={{ width: `${Math.min(progress, 100)}%` }}
      />
      <span className="absolute inset-0 flex items-center justify-center text-xs font-bold text-gray-800">
        {label || `${Math.round(progress)}%`}
      </span>
    </div>
  );
}
