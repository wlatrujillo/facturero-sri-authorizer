import { SriEnv, VoucherStatus } from "./enums";

export interface IVoucherId {
    voucherType: string;
    environment: SriEnv;
    establishment: string;
    branch: string;
    sequence: string;
}

export interface IVoucher {
    companyId: string;
    voucherId: IVoucherId;
    accessKey?: string;
    xml: string;
    status: VoucherStatus;
    sriStatus?: string;
    sriErrorIdentifier?: string;
    messages?: string[];
    createdAt: string;
    updatedAt: string;
}

export interface VoucherMessage {
    accessKey: string;
}