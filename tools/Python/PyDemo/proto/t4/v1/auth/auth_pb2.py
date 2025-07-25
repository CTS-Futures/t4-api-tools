# -*- coding: utf-8 -*-
# Generated by the protocol buffer compiler.  DO NOT EDIT!
# NO CHECKED-IN PROTOBUF GENCODE
# source: t4/v1/auth/auth.proto
# Protobuf Python Version: 6.31.1
"""Generated protocol buffer code."""
from google.protobuf import descriptor as _descriptor
from google.protobuf import descriptor_pool as _descriptor_pool
from google.protobuf import runtime_version as _runtime_version
from google.protobuf import symbol_database as _symbol_database
from google.protobuf.internal import builder as _builder
_runtime_version.ValidateProtobufRuntimeVersion(
    _runtime_version.Domain.PUBLIC,
    6,
    31,
    1,
    '',
    't4/v1/auth/auth.proto'
)
# @@protoc_insertion_point(imports)

_sym_db = _symbol_database.Default()


from google.protobuf import timestamp_pb2 as google_dot_protobuf_dot_timestamp__pb2
from t4.v1.common import enums_pb2 as t4_dot_v1_dot_common_dot_enums__pb2


DESCRIPTOR = _descriptor_pool.Default().AddSerializedFile(b'\n\x15t4/v1/auth/auth.proto\x12\x0ft4proto.v1.auth\x1a\x1fgoogle/protobuf/timestamp.proto\x1a\x18t4/v1/common/enums.proto\"\xae\x01\n\x0cLoginRequest\x12\x0f\n\x07\x61pi_key\x18\x01 \x01(\t\x12\x0c\n\x04\x66irm\x18\x02 \x01(\t\x12\x10\n\x08username\x18\x03 \x01(\t\x12\x10\n\x08password\x18\x04 \x01(\t\x12\x10\n\x08\x61pp_name\x18\x05 \x01(\t\x12\x13\n\x0b\x61pp_license\x18\x06 \x01(\t\x12\x34\n\x0cprice_format\x18\n \x01(\x0e\x32\x1e.t4proto.v1.common.PriceFormat\"\xee\x06\n\rLoginResponse\x12.\n\x06result\x18\x01 \x01(\x0e\x32\x1e.t4proto.v1.common.LoginResult\x12\x12\n\nsession_id\x18\x02 \x01(\t\x12\x0f\n\x07user_id\x18\x03 \x01(\t\x12\x0f\n\x07\x66irm_id\x18\x04 \x01(\t\x12\r\n\x05roles\x18\x05 \x03(\t\x12\x15\n\rerror_message\x18\x06 \x01(\t\x12:\n\texchanges\x18\x07 \x03(\x0b\x32\'.t4proto.v1.auth.LoginResponse.Exchange\x12\x38\n\x08\x61\x63\x63ounts\x18\x08 \x03(\x0b\x32&.t4proto.v1.auth.LoginResponse.Account\x12G\n\x14\x61uthentication_token\x18\t \x01(\x0b\x32$.t4proto.v1.auth.AuthenticationTokenH\x00\x88\x01\x01\x1a\xe6\x02\n\x08\x45xchange\x12\x13\n\x0b\x65xchange_id\x18\x01 \x01(\t\x12\x0f\n\x07user_id\x18\x02 \x01(\t\x12;\n\x10market_data_type\x18\x03 \x01(\x0e\x32!.t4proto.v1.common.MarketDataType\x12\x1d\n\x15has_executing_account\x18\x04 \x01(\x08\x12\x17\n\x0fprimary_user_id\x18\x05 \x01(\t\x12\x19\n\x11secondary_user_id\x18\x06 \x01(\t\x12\x10\n\x08location\x18\x07 \x01(\t\x12\x0e\n\x06smp_id\x18\x08 \x01(\t\x12N\n\x0c\x65xtra_detail\x18\t \x03(\x0b\x32\x38.t4proto.v1.auth.LoginResponse.Exchange.ExtraDetailEntry\x1a\x32\n\x10\x45xtraDetailEntry\x12\x0b\n\x03key\x18\x01 \x01(\t\x12\r\n\x05value\x18\x02 \x01(\t:\x02\x38\x01\x1a\x8f\x01\n\x07\x41\x63\x63ount\x12\x12\n\naccount_id\x18\x01 \x01(\t\x12\x16\n\x0e\x61\x63\x63ount_number\x18\x02 \x01(\t\x12\x14\n\x0c\x61\x63\x63ount_name\x18\x03 \x01(\t\x12\x14\n\x0c\x64isplay_name\x18\x04 \x01(\t\x12,\n\x04mode\x18\x05 \x01(\x0e\x32\x1e.t4proto.v1.common.AccountModeB\x17\n\x15_authentication_token\"0\n\x1a\x41uthenticationTokenRequest\x12\x12\n\nrequest_id\x18\x01 \x01(\t\"\xb9\x01\n\x13\x41uthenticationToken\x12\x12\n\nrequest_id\x18\x01 \x01(\t\x12\x12\n\x05token\x18\x02 \x01(\tH\x00\x88\x01\x01\x12\x34\n\x0b\x65xpire_time\x18\x03 \x01(\x0b\x32\x1a.google.protobuf.TimestampH\x01\x88\x01\x01\x12\x19\n\x0c\x66\x61il_message\x18\x04 \x01(\tH\x02\x88\x01\x01\x42\x08\n\x06_tokenB\x0e\n\x0c_expire_timeB\x0f\n\r_fail_messageb\x06proto3')

_globals = globals()
_builder.BuildMessageAndEnumDescriptors(DESCRIPTOR, _globals)
_builder.BuildTopDescriptorsAndMessages(DESCRIPTOR, 't4.v1.auth.auth_pb2', _globals)
if not _descriptor._USE_C_DESCRIPTORS:
  DESCRIPTOR._loaded_options = None
  _globals['_LOGINRESPONSE_EXCHANGE_EXTRADETAILENTRY']._loaded_options = None
  _globals['_LOGINRESPONSE_EXCHANGE_EXTRADETAILENTRY']._serialized_options = b'8\001'
  _globals['_LOGINREQUEST']._serialized_start=102
  _globals['_LOGINREQUEST']._serialized_end=276
  _globals['_LOGINRESPONSE']._serialized_start=279
  _globals['_LOGINRESPONSE']._serialized_end=1157
  _globals['_LOGINRESPONSE_EXCHANGE']._serialized_start=628
  _globals['_LOGINRESPONSE_EXCHANGE']._serialized_end=986
  _globals['_LOGINRESPONSE_EXCHANGE_EXTRADETAILENTRY']._serialized_start=936
  _globals['_LOGINRESPONSE_EXCHANGE_EXTRADETAILENTRY']._serialized_end=986
  _globals['_LOGINRESPONSE_ACCOUNT']._serialized_start=989
  _globals['_LOGINRESPONSE_ACCOUNT']._serialized_end=1132
  _globals['_AUTHENTICATIONTOKENREQUEST']._serialized_start=1159
  _globals['_AUTHENTICATIONTOKENREQUEST']._serialized_end=1207
  _globals['_AUTHENTICATIONTOKEN']._serialized_start=1210
  _globals['_AUTHENTICATIONTOKEN']._serialized_end=1395
# @@protoc_insertion_point(module_scope)
