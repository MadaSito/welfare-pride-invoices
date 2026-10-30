declare module "@microsoft/clarity" {
  const Clarity: {
    init(projectId: string): void;
    consent(consent?: boolean): void;
    setTag(key: string, value: string): void;
    identify(customerId: string, customSessionId?: string, customPageId?: string, friendlyName?: string): void;
    event(eventName: string): void;
  };
  export default Clarity;
}
