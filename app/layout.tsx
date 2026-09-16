import './globals.css'; import { Nav } from '@/components/Nav';
export const metadata={title:'PrivyGuard',description:'AI-powered data privacy and governance'};
export default function RootLayout({children}:{children:React.ReactNode}){return <html lang="en"><body><div className="shell"><Nav/><main className="main">{children}</main></div></body></html>}
