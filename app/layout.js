import "./globals.css";

export const metadata = {
  title: "iTranslate Demo — AssemblyAI Universal-3 Pro",
  description:
    "Real-time voice-to-voice translation pipeline powered by AssemblyAI Universal-3 Pro streaming STT with native code-switching, Cohere LLM translation, and browser-native TTS.",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
