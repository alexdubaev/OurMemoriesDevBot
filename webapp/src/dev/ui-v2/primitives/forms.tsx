/* eslint-disable typographyPolicy/use-typography-component -- labels are styled by the Lab's semantic field token, independently of production Typography. */
import type { InputHTMLAttributes, ReactNode } from 'react'
export function Field({ label, children }: { label: string; children: ReactNode }) { return <label className="v2-field"><span className="v2-field-label">{label}</span>{children}</label> }
export function TextField({ label, ...props }: InputHTMLAttributes<HTMLInputElement> & { label: string }) { return <Field label={label}><input {...props} /></Field> }
