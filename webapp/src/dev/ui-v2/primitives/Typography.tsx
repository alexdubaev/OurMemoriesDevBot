import type { HTMLAttributes, ReactNode } from 'react'
type TextProps = HTMLAttributes<HTMLElement> & { as?: 'p' | 'span' | 'h1' | 'h2' | 'h3' | 'strong' | 'small'; variant?: 'body' | 'meta' | 'caption' | 'person' | 'section' | 'title' | 'display'; children?: ReactNode }
export function Typography({ as: Tag = 'p', variant = 'body', className = '', ...props }: TextProps) {
  return <Tag className={'v2-text v2-text--' + variant + ' ' + className} {...props} />
}
export function PersonName({ children }: { children: ReactNode }) { return <Typography as="span" variant="person">{children}</Typography> }
