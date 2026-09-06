import { Alert } from "@/components/ui/alert";

interface ServerErrorProps {
  message?: string | null;
}

export function ServerError({ message }: ServerErrorProps) {
  return <Alert variant="error" message={message} />;
}
