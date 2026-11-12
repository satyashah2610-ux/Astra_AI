import type { Delivery } from './files';

type Props = { value: Delivery; onChange: (value: Delivery) => void; disabled?: boolean; emailLabel?: string };

/** "Email the link" and, under it, "Remind them daily": the reminder box is greyed out when the link isn't emailed. */
export default function DeliveryChoice({ value, onChange, disabled, emailLabel = 'Email the link to the signer' }: Props) {
  return <div className="delivery-choice">
    <label className="check-row"><input type="checkbox" checked={value.email} disabled={disabled} onChange={e => onChange({ ...value, email: e.target.checked })} />{emailLabel}</label>
    <label className={`check-row nested ${value.email ? '' : 'off'}`}>
      <input type="checkbox" checked={value.email && value.reminders} disabled={disabled || !value.email} onChange={e => onChange({ ...value, reminders: e.target.checked })} />
      Remind them every day for up to 7 days if it isn’t signed
    </label>
  </div>;
}
