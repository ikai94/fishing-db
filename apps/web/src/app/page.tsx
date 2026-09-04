import { HomeDashboard } from './_components/home-dashboard';
import { ApplicationShell } from '@/components/application-shell/application-shell';

export default function Home() {
  return (
    <ApplicationShell>
      <HomeDashboard />
    </ApplicationShell>
  );
}
