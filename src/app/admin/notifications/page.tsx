import { BellRing } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export default function NotificationsPage() {
  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          Notification Preferences
        </h1>
        <p className="text-sm text-muted-foreground">
          Manage how and when you receive notifications.
        </p>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <BellRing className="h-5 w-5 text-muted-foreground" />
            <CardTitle>Coming Soon</CardTitle>
          </div>
          <CardDescription>
            Notification preferences are not yet available. You&apos;ll be able
            to configure email and in-app notifications for bookings, schedule
            changes, and more.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-center rounded-lg border border-dashed border-gray-200 py-12">
            <p className="text-sm text-muted-foreground">
              Check back soon for notification settings.
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
