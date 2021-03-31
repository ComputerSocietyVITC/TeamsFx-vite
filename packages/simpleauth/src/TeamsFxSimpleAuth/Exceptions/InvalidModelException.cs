﻿using System.Net;

namespace Microsoft.TeamsFxSimpleAuth.Exceptions
{
    // Indicates request body validation failure
    public class InvalidModelException : ApiExceptionBase
    {
        public InvalidModelException(string message)
            : base(message, HttpStatusCode.BadRequest) { }
    }
}
