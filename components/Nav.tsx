import Link from 'next/link';
const links=[['/demo','Dashboard'],['/discovery','Data Discovery'],['/copilot','Regulatory Copilot'],['/governance','Privacy Governance'],['/ropa','Processing Intelligence'],['/risk','Risk & Controls'],['/rights','Data Principal Rights'],['/analytics','Analytics']];
export function Nav(){return <aside className="side"><div className="brand">Privacy Intelligence<br/><span>Platform</span></div><div className="muted" style={{padding:'0 12px 8px',color:'#8393b4'}}>CONTINUOUS PRIVACY</div>{links.map(([href,label])=><Link key={href} href={href}>{label}</Link>)}</aside>}

