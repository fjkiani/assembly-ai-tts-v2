import "./globals.css";

export const metadata = {
  title: "Notes",
  description: "Personal notes",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
