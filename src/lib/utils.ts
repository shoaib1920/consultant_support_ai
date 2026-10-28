import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function pkr(n: number) {
  return `PKR ${Math.round(n).toLocaleString("en-GB")}`;
}
