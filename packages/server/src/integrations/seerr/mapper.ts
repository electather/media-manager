import type { SerrRequest, SerrMediaInfo } from './types'
import type { RequestStatus, AvailabilityStatus } from '../types'

// TODO: implement - map Seerr request to internal RequestStatus.
export function mapSerrRequest(_raw: SerrRequest): RequestStatus {
  throw new Error('Not implemented')
}

// TODO: implement - map Seerr media status code to AvailabilityStatus.
export function mapSerrAvailability(_raw: SerrMediaInfo): AvailabilityStatus {
  throw new Error('Not implemented')
}
