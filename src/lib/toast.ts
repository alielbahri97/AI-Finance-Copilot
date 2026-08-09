import { toast as sonnerToast } from "sonner";

import { feedback } from "@/lib/feedback";

type ToastFn = typeof sonnerToast;

/**
 * Sonner toast with Revolut-style success/error cues layered on top.
 * Drop-in replacement for `import { toast } from "@/lib/toast"`.
 */
export const toast: ToastFn = Object.assign(
  ((...args: Parameters<ToastFn>) => sonnerToast(...args)) as ToastFn,
  {
    ...sonnerToast,
    success: ((message, data) => {
      feedback.success();
      return sonnerToast.success(message, data);
    }) as typeof sonnerToast.success,
    error: ((message, data) => {
      feedback.error();
      return sonnerToast.error(message, data);
    }) as typeof sonnerToast.error,
    warning: ((message, data) => {
      feedback.warning();
      return sonnerToast.warning(message, data);
    }) as typeof sonnerToast.warning,
  }
);
