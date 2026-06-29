import "./globals.css";

export const metadata = {
  title: "EN-WORD",
  description: "A responsive word memorization site for business English."
};

export default function RootLayout({ children }) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
