import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/**
 * 为什么需要 cn()：
 * Tailwind 是"后写胜出"还是"定义靠后胜出"取决于生成的 CSS 顺序，
 * 组件默认样式与调用方传入的 className 冲突时结果不可预期。
 * twMerge 能识别语义冲突（如 px-2 与 px-4），保留后者，从而实现可靠的样式覆盖。
 */
export const cn = (...inputs: ClassValue[]): string => twMerge(clsx(inputs));
